import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { z } from 'zod';

/**
 * Single place that knows how to talk to Gemini via LangChain.
 * Every feature module (chat, vision, news-agent) should go through
 * this service instead of instantiating ChatGoogleGenerativeAI itself.
 * That keeps API-key handling, model selection and retry/error logic
 * in one spot, and makes it trivial to swap models later.
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  private readonly chatModel: ChatGoogleGenerativeAI;
  private readonly visionModel: ChatGoogleGenerativeAI;
  private readonly structuredModel: ChatGoogleGenerativeAI;
  private readonly multimodalStructuredModel: ChatGoogleGenerativeAI;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in the environment');
    }

    const chatModelName =
      this.config.get<string>('GEMINI_CHAT_MODEL') ?? 'gemini-3.8-flash';
    const visionModelName =
      this.config.get<string>('GEMINI_VISION_MODEL') ?? 'gemini-3.8-flash';

    // Two separate instances so you can tune temperature/maxTokens
    // independently for conversational text vs. image description.
    this.chatModel = new ChatGoogleGenerativeAI({
      apiKey,
      model: chatModelName,
      temperature: 0.7,
      maxOutputTokens: 1024,
    });

    this.visionModel = new ChatGoogleGenerativeAI({
      apiKey,
      model: visionModelName,
      temperature: 0.4,
      maxOutputTokens: 1024,
    });

    // Used for multi-item structured JSON output (e.g. the news agent's
    // newsletter draft). A much higher token ceiling than chatModel so a
    // 5-7 item payload can't get cut off mid-JSON and fail to parse.
    this.structuredModel = new ChatGoogleGenerativeAI({
      apiKey,
      model: chatModelName,
      temperature: 0.4,
      maxOutputTokens: 8192,
    });

    // Structured output on top of the vision-capable model — used by the
    // revision module to transcribe spoken study sessions (audio input)
    // and/or analyze typed study notes in a single multimodal call.
    this.multimodalStructuredModel = new ChatGoogleGenerativeAI({
      apiKey,
      model: visionModelName,
      temperature: 0.3,
      maxOutputTokens: 2048,
    });
  }

  /**
   * Generic text/chat call. `history` should already be in chronological
   * order (oldest first) and NOT include the new user message — pass that
   * separately as `userInput`.
   */
  async chat(params: {
    systemPrompt?: string;
    history: BaseMessage[];
    userInput: string;
  }): Promise<string> {
    const messages: BaseMessage[] = [];

    if (params.systemPrompt) {
      messages.push(new SystemMessage(params.systemPrompt));
    }

    messages.push(...params.history);
    messages.push(new HumanMessage(params.userInput));

    try {
      const response = await this.chatModel.invoke(messages);
      return this.extractText(response.content);
    } catch (err) {
      this.logger.error('Gemini chat call failed', err as Error);
      throw err;
    }
  }

  /**
   * One-shot text generation with no conversation history — used by the
   * news agent for summarization/newsletter generation.
   */
  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: BaseMessage[] = [];
    if (systemPrompt) messages.push(new SystemMessage(systemPrompt));
    messages.push(new HumanMessage(prompt));

    const response = await this.chatModel.invoke(messages);
    return this.extractText(response.content);
  }

  /**
   * Schema-enforced generation: give it a zod schema and get back a typed,
   * already-parsed object — no manual JSON.parse/regex-stripping, and no
   * risk of the model wrapping output in markdown fences or prose. Under
   * the hood this uses Gemini's native structured-output / function-calling
   * support via LangChain's `withStructuredOutput`. Use this instead of
   * `complete()` any time you need multi-field or list output (e.g. the
   * news agent's newsletter draft).
   */
  async generateStructured<T extends z.ZodTypeAny>(params: {
    prompt: string;
    schema: T;
    systemPrompt?: string;
  }): Promise<z.infer<T>> {
    // Zod v4 restructured its internal generics, so passing z.infer<T>
    // explicitly as withStructuredOutput's generic no longer satisfies its
    // Record<string, any> constraint when T is itself generic. Letting the
    // overload infer RunOutput from the schema (instead of pinning it
    // explicitly) sidesteps that — the accurate z.infer<T> return type is
    // restored via the cast on the invoke() result below.
    const structuredModel = this.structuredModel.withStructuredOutput(
      params.schema as z.ZodType<Record<string, any>>,
    );

    const messages: BaseMessage[] = [];
    if (params.systemPrompt)
      messages.push(new SystemMessage(params.systemPrompt));
    messages.push(new HumanMessage(params.prompt));

    try {
      return (await structuredModel.invoke(messages)) as z.infer<T>;
    } catch (err) {
      this.logger.error('Gemini structured generation failed', err as Error);
      throw err;
    }
  }

  /**
   * Multimodal call: send an image (base64) + a text instruction and get
   * a description back. mimeType e.g. 'image/png' | 'image/jpeg'.
   */
  async describeImage(params: {
    base64Image: string;
    mimeType: string;
    instruction?: string;
  }): Promise<string> {
    const message = new HumanMessage({
      content: [
        {
          type: 'text',
          text:
            params.instruction ??
            'Describe this image in detail: objects, setting, colors, mood, and any visible text.',
        },
        {
          type: 'image_url',
          image_url: `data:${params.mimeType};base64,${params.base64Image}`,
        },
      ],
    });

    try {
      const response = await this.visionModel.invoke([message]);
      return this.extractText(response.content);
    } catch (err) {
      this.logger.error('Gemini vision call failed', err as Error);
      throw err;
    }
  }

  /**
   * Powers the revision-reminder module: give it either spoken audio
   * (base64, e.g. recorded in the frontend) and/or typed text describing
   * what the user just studied, plus a zod schema, and get back a typed,
   * structured analysis (transcript, topic, summary, understanding score,
   * ...). When audio is provided, Gemini transcribes it AND analyzes it
   * in the same call — no separate speech-to-text step needed.
   */
  async analyzeStudyInput<T extends z.ZodTypeAny>(params: {
    instructionText: string;
    schema: T;
    audio?: { base64: string; mimeType: string };
  }): Promise<z.infer<T>> {
    const content = params.audio
      ? [
          { type: 'text' as const, text: params.instructionText },
          {
            type: 'audio' as const,
            mimeType: params.audio.mimeType,
            data: params.audio.base64,
          },
        ]
      : [{ type: 'text' as const, text: params.instructionText }];

    const baseModel = params.audio
      ? this.multimodalStructuredModel
      : this.structuredModel;
    const structuredModel = baseModel.withStructuredOutput(
      params.schema as z.ZodType<Record<string, any>>,
    );

    const message = new HumanMessage({ content });

    try {
      return (await structuredModel.invoke([message])) as z.infer<T>;
    } catch (err) {
      this.logger.error('Gemini study-input analysis failed', err as Error);
      throw err;
    }
  }

  private extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part: any) =>
          typeof part === 'string' ? part : (part?.text ?? ''),
        )
        .join('')
        .trim();
    }
    return String(content ?? '');
  }
}

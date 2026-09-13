import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { GeminiService } from '../../common/gemini/gemini.service';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';

const SYSTEM_PROMPT =
  'You are a helpful, concise general-purpose assistant. ' +
  'Use the prior conversation for context and stay consistent with earlier answers.';

// Only the last N messages are sent to the model on every turn, to keep
// token usage/latency bounded as conversations grow. Increase if you add
// a summarization step for long-running conversations.
const MAX_HISTORY_MESSAGES = 20;

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    private readonly gemini: GeminiService,
  ) {}

  async listConversations(userId: string) {
    return this.conversationModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('_id title createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .exec();
  }

  async getConversation(userId: string, conversationId: string) {
    const convo = await this.findOwnedConversation(userId, conversationId);
    return convo;
  }

  async deleteConversation(userId: string, conversationId: string) {
    const convo = await this.findOwnedConversation(userId, conversationId);
    await convo.deleteOne();
    return { deleted: true };
  }

  async sendMessage(userId: string, message: string, conversationId?: string) {
    const convo = conversationId
      ? await this.findOwnedConversation(userId, conversationId)
      : await this.conversationModel.create({
          userId: new Types.ObjectId(userId),
          title: message.slice(0, 60),
          messages: [],
        });

    const history: BaseMessage[] = convo.messages
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) =>
        m.role === 'human' ? new HumanMessage(m.content) : new AIMessage(m.content),
      );

    const reply = await this.gemini.chat({
      systemPrompt: SYSTEM_PROMPT,
      history,
      userInput: message,
    });

    convo.messages.push(
      { role: 'human', content: message, createdAt: new Date() },
      { role: 'ai', content: reply, createdAt: new Date() },
    );
    await convo.save();

    return {
      conversationId: convo._id.toString(),
      reply,
    };
  }

  private async findOwnedConversation(userId: string, conversationId: string) {
    const convo = await this.conversationModel.findById(conversationId).exec();
    if (!convo) throw new NotFoundException('Conversation not found');
    if (convo.userId.toString() !== userId) {
      throw new ForbiddenException('This conversation does not belong to you');
    }
    return convo;
  }
}

import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message: string;

  // Omit to start a brand new conversation
  @IsOptional()
  @IsString()
  conversationId?: string;
}

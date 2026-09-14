import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../auth/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // List all conversations for the logged-in user (sidebar list)
  @Get('conversations')
  listConversations(@CurrentUser() user: AuthUser) {
    return this.chatService.listConversations(user.userId);
  }

  // Full message history for one conversation
  @Get('conversations/:id')
  getConversation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chatService.getConversation(user.userId, id);
  }

  @Delete('conversations/:id')
  deleteConversation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chatService.deleteConversation(user.userId, id);
  }

  // Send a message; omit conversationId to start a new conversation
  @Post('message')
  sendMessage(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(
      user.userId,
      dto.message,
      dto.conversationId,
    );
  }
}

import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateNewsletterDto {
  // Plain-English goal, e.g. "Create a weekly newsletter on the latest
  // AI agent news and send it to our subscribers."
  @IsOptional()
  @IsString()
  @MaxLength(500)
  goal?: string;

  // What to search for. Defaults to "AI agents" if omitted.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;
}

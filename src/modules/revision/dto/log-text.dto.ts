import { IsString, MaxLength, MinLength } from 'class-validator';

export class LogTextDto {
  // What the user typed/said (already transcribed) about what they studied.
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  text: string;
}

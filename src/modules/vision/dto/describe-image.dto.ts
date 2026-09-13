import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DescribeImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instruction?: string;
}

import { IsInt, Max, Min } from 'class-validator';

export class ReviewDto {
  // Self- or quiz-assessed recall quality, SM-2 scale: 0 (blank) .. 5 (perfect)
  @IsInt()
  @Min(0)
  @Max(5)
  quality: number;
}

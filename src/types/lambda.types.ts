export interface LambdaEvent {
  municipality?: string;
  batchSize?: number;
}

export interface ProcessingResult {
  processed: number;
  saved: number;
  skipped: number;
  errors: number;
  elapsedSeconds: number;
}

export interface LambdaResponse {
  statusCode: number;
  body: string;
}

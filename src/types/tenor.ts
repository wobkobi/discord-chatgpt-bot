export interface TenorMediaFormat {
  url: string;
}
export interface TenorResult {
  media_formats?: {
    gif?: TenorMediaFormat;
    [k: string]: unknown; // ignore other formats safely
  };
}
export interface TenorSearchResponse {
  results: TenorResult[];
}

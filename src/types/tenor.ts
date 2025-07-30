export interface TenorMediaFormat {
  url: string;
}
export interface TenorMedia {
  gif: TenorMediaFormat;
}
export interface TenorResult {
  media: TenorMedia[];
}
export interface TenorSearchResponse {
  results: TenorResult[];
}

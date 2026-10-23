import type { ApiErrorResponse } from '../types';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export interface Props {
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  data?: { path: string };
}

export function TranslationStatus({ isSuccess, isError, error, data }: Props) {
  if (!isSuccess && !isError) return null;

  if (isSuccess) {
    return (
      <div className="rounded-lg bg-green-50 p-4 flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-green-800">Translation Complete!</div>
          <div className="mt-1 text-sm text-green-600">
            File saved at: {data?.path}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    // Extract the error message
    let errorMessage = 'An unknown error occurred';
    let technicalDetails = '';

    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Check if this is our enhanced API error with details
      const apiError = error as Error & Partial<ApiErrorResponse>;
      if (apiError.apiDetails || apiError.deeplRequest) {
        technicalDetails = JSON.stringify({
          apiDetails: apiError.apiDetails,
          deeplRequest: apiError.deeplRequest
        }, null, 2);
      }
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error === 'object') {
      errorMessage = JSON.stringify(error);
    }

    return (
      <div className="rounded-lg bg-red-50 p-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="w-full">
          <div className="font-medium text-red-800">Translation Failed</div>
          <div className="mt-1 text-sm text-red-600">
            {errorMessage}
          </div>
          
          {technicalDetails && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-red-700">Technical details</summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-sm bg-red-100 p-2 text-xs text-red-800">
                {technicalDetails}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  return null;
}
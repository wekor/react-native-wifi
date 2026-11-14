/** A WifiError as `code: message (nativeCode)`, another Error as its message, anything else as its string. */
export const errorText = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code, message, nativeCode } = error as {
      code: string;
      message: string;
      nativeCode?: number;
    };
    return `${code}: ${message}${nativeCode === undefined ? '' : ` (${nativeCode})`}`;
  }
  return error instanceof Error ? error.message : String(error);
};

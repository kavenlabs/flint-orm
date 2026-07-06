// -----------------------------------------------------------------------
// Error classes — typed errors for better error handling.
// -----------------------------------------------------------------------

/** Base error class for all flint-orm errors. */
export class FlintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlintError";
  }
}

/** Thrown when a value violates a column constraint (notNull, type mismatch). */
export class ValidationError extends FlintError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown when a SQL query fails to execute. */
export class QueryError extends FlintError {
  public readonly originalError?: Error;
  constructor(message: string, originalError?: Error) {
    super(message);
    this.name = "QueryError";
    this.originalError = originalError;
  }
}

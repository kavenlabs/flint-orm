// Error classes

/** Base error class for all flint-orm errors. */
export class FlintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlintError';
  }
}

/** Thrown when a value violates a column constraint or a validation rule fails. */
export class FlintValidationError extends FlintError {
  constructor(message: string) {
    super(message);
    this.name = 'FlintValidationError';
  }
}

/** Thrown when a SQL query fails to execute. */
export class FlintQueryError extends FlintError {
  public readonly originalError?: Error;
  constructor(message: string, originalError?: Error) {
    super(message);
    this.name = 'FlintQueryError';
    this.originalError = originalError;
  }
}

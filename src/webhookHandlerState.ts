const handlerErrors = new WeakMap<object, unknown>();

export function rememberWebhookHandlerError(update: object, error: unknown): void {
  handlerErrors.set(update, error);
}

export function takeWebhookHandlerError(update: object): unknown {
  const error = handlerErrors.get(update);
  handlerErrors.delete(update);
  return error;
}

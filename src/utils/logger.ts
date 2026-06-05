const isProduction = process.env.NODE_ENV === "production";

export const logger = {
  info(message: string, meta?: unknown): void {
    if (meta === undefined || isProduction) {
      console.log(message);
      return;
    }
    console.log(message, meta);
  },

  warn(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.warn(message);
      return;
    }
    console.warn(message, meta);
  },

  error(message: string, error?: unknown): void {
    if (error === undefined) {
      console.error(message);
      return;
    }
    console.error(message, error);
  },
};

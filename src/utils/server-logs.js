function normalizeContextValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message.replace(/(\w+:\/\/)[^/@\s]+@/g, '$1[REDACTED]@'),
      ...(value.code ? { code: value.code } : {})
    };
  }
  if (typeof value === 'string') {
    return value.replace(/(\w+:\/\/)[^/@\s]+@/g, '$1[REDACTED]@');
  }
  if (Array.isArray(value)) return value.map(normalizeContextValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeContextValue(nestedValue)])
    );
  }
  return value;
}

export async function writeServerLog(prisma, { level, source, message, context = undefined }) {
  if (typeof prisma.serverLog?.create !== 'function') return;

  try {
    await prisma.serverLog.create({
      data: {
        level,
        source,
        message: normalizeContextValue(message),
        ...(context === undefined ? {} : { context: normalizeContextValue(context) })
      }
    });
  } catch (error) {
    console.error('Could not persist server log', {
      source,
      message,
      error: error instanceof Error ? error.message : 'Unknown log persistence error'
    });
  }
}

export function createPersistentLogger(prisma, source, fallback = console) {
  return {
    info(context, message) {
      fallback.info(context, message);
      void writeServerLog(prisma, { level: 'INFO', source, message, context });
    },
    warn(context, message) {
      fallback.warn(context, message);
      void writeServerLog(prisma, { level: 'WARN', source, message, context });
    },
    error(context, message) {
      fallback.error(context, message);
      void writeServerLog(prisma, { level: 'ERROR', source, message, context });
    }
  };
}

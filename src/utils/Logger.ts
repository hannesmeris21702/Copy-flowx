require("dotenv").config();

import _ from "lodash";
import winston, { format } from "winston";
import Transport from "winston-transport";
import util from "util";
import path from "path";

const { combine, timestamp, colorize, printf } = winston.format;

const enumerateErrorFormat = winston.format((info) => {
  if (info instanceof Error) {
    const output = Object.assign(
      {
        message: info.message,
        stack: info.stack,
      },
      info
    );

    return output;
  }

  return info;
});

export function safeToString(json: any): string {
  if (isEmpty(json)) {
    return null;
  }

  try {
    return JSON.stringify(json);
  } catch (ex) {
    return util.inspect(json);
  }
}

export function isEmpty(obj: any): boolean {
  // null and undefined are "empty"
  if (obj == null) return true;

  // Assume if it has a length property with a non-zero value
  // that that property is correct.
  if (obj.length > 0) return false;
  if (obj.length === 0) return true;

  // If it isn't an object at this point
  // it is empty, but it can't be anything *but* empty
  // Is it empty?  Depends on your application.
  if (typeof obj !== "object") return true;

  // Otherwise, does it have any properties of its own?
  // Note that this doesn't handle
  // toString and valueOf enumeration bugs in IE < 9
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return false;
  }

  return true;
}

const file = (thisModule?: NodeJS.Module) =>
  format((info: any) => {
    if (!thisModule) {
      return info;
    }
    const BASE_PATH = path.resolve(".");
    const fileName = thisModule.filename;
    const moduleName = fileName.split(BASE_PATH)[1];
    return { ...info, moduleName };
  });

export function getLogger(thisModule?: NodeJS.Module): winston.Logger {
  const isLoggerExisted = winston.loggers.has(thisModule?.filename);
  if (!isLoggerExisted) {
    createLogger(thisModule);
  }

  return winston.loggers.get(thisModule?.filename);
}

function createLogger(thisModule?: NodeJS.Module) {
  winston.loggers.add(thisModule?.filename, {
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(timestamp(), enumerateErrorFormat()),
    transports: _createConsoleTransport(thisModule),
  });
}

function _createConsoleTransport(thisModule?: NodeJS.Module): Transport {
  return new winston.transports.Console({
    format: combine(
      colorize(),
      file(thisModule)(),
      printf(
        (info) =>
          `[${info.timestamp}] ${info.level}  [${info.moduleName}]: ${
            info.message
          } ${info.stack ? `\n${info.stack}` : ""}`
      )
    ),
    stderrLevels: ["error"],
  });
}

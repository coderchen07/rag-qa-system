import "reflect-metadata";
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import * as dotenv from "dotenv";

dotenv.config();

@Catch()
class GlobalHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException
        ? this.extractMessage(exception.getResponse())
        : "Internal server error";

    if (exception instanceof Error) {
      const maybeResponse = (
        exception as Error & {
          response?: { status?: number; data?: unknown };
        }
      ).response;
      console.error("[GlobalHttpExceptionFilter] request failed", {
        method: request?.method,
        url: request?.url,
        status,
        message: exception.message,
        stack: exception.stack,
        upstreamStatus: maybeResponse?.status,
        upstreamData: maybeResponse?.data,
      });
    } else {
      console.error("[GlobalHttpExceptionFilter] request failed", {
        method: request?.method,
        url: request?.url,
        status,
        exception,
      });
    }

    response.status(status).json({
      code: -1,
      message,
    });
  }

  private extractMessage(response: string | object): string {
    if (typeof response === "string") {
      return response;
    }

    if (
      response &&
      typeof response === "object" &&
      "message" in response &&
      Array.isArray((response as { message?: unknown }).message)
    ) {
      return String((response as { message: unknown[] }).message[0]);
    }

    if (
      response &&
      typeof response === "object" &&
      "message" in response
    ) {
      return String((response as { message?: unknown }).message);
    }

    return "Request failed";
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  app.enableCors({
    origin: frontendOrigin,
    credentials: true,
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();

import { z } from "zod";
import { jsonVideoSchema } from "../src/JsonVideo/schema";

export const createRenderSchema = z
  .object({
    compositionId: z.literal("JsonVideo"),
    inputProps: jsonVideoSchema,
  })
  .strict();

export type RenderRequest = z.infer<typeof createRenderSchema>;

import { z } from 'zod';

export const skuParamSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'sku aceita apenas letras, numeros, ponto, hifen e sublinhado'),
});

export const restockSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/),
  quantity: z.number().int().positive().max(1_000_000),
  description: z.string().trim().max(200).optional(),
});

export type RestockInput = z.infer<typeof restockSchema>;

import { z } from 'zod';
import { orderStatusSchema, paginationQuerySchema } from '@loja-veloz/shared-types';

export const MAX_ITEMS_PER_ORDER = 50;

export const createOrderItemSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'sku e obrigatorio')
    .max(64, 'sku excede 64 caracteres')
    .regex(/^[A-Za-z0-9._-]+$/, 'sku aceita apenas letras, numeros, ponto, hifen e sublinhado'),
  quantity: z.number().int('quantity deve ser inteiro').positive('quantity deve ser maior que zero'),
  unitPrice: z
    .number()
    .nonnegative('unitPrice nao pode ser negativo')
    .max(1_000_000, 'unitPrice acima do limite aceito'),
});

export const createOrderSchema = z.object({
  customerId: z
    .string()
    .trim()
    .min(1, 'customerId e obrigatorio')
    .max(64, 'customerId excede 64 caracteres'),
  items: z
    .array(createOrderItemSchema)
    .min(1, 'o pedido precisa de ao menos um item')
    .max(MAX_ITEMS_PER_ORDER, `o pedido aceita no maximo ${MAX_ITEMS_PER_ORDER} itens`)
    // SKU repetido tornaria a reserva de estoque ambigua.
    .refine(
      (items) => new Set(items.map((item) => item.sku)).size === items.length,
      'nao e permitido repetir o mesmo sku no pedido'
    ),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  status: orderStatusSchema.optional(),
  customerId: z.string().trim().min(1).max(64).optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const orderIdParamSchema = z.object({
  id: z.string().uuid('identificador de pedido invalido'),
});

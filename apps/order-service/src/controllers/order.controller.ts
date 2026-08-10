import type { NextFunction, Request, Response } from 'express';
import type { OrderService } from '../services/order.service';
import {
  createOrderSchema,
  listOrdersQuerySchema,
  orderIdParamSchema,
} from '../schemas/order.schema';
import type { OrderRecord } from '../repositories/order.repository';

/** Representacao publica do pedido. Datas em ISO 8601, valores em reais. */
function toResponse(order: OrderRecord) {
  return {
    id: order.id,
    customerId: order.customerId,
    status: order.status,
    total: order.total,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items,
  };
}

export class OrderController {
  constructor(private readonly service: OrderService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // O schema lanca ZodError, traduzido em 400 pelo handler de erro global.
      const input = createOrderSchema.parse(req.body);
      const correlationId = res.locals.correlationId as string;
      const order = await this.service.createOrder(input, correlationId);

      res.status(201).location(`/orders/${order.id}`).json(toResponse(order));
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listOrdersQuerySchema.parse(req.query);
      const result = await this.service.listOrders(query);

      res.status(200).json({
        data: result.data.map(toResponse),
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = orderIdParamSchema.parse(req.params);
      const order = await this.service.getOrder(id);
      res.status(200).json(toResponse(order));
    } catch (error) {
      next(error);
    }
  };
}

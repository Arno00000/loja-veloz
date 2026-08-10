import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import type { PaymentService } from '../services/payment.service';

const orderIdParamSchema = z.object({
  orderId: z.string().uuid('identificador de pedido invalido'),
});

export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  getByOrderId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { orderId } = orderIdParamSchema.parse(req.params);
      const payment = await this.service.getByOrderId(orderId);

      res.status(200).json({
        id: payment.id,
        orderId: payment.orderId,
        status: payment.status,
        amount: payment.amount,
        externalReference: payment.externalReference,
        failureReason: payment.failureReason,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  };
}

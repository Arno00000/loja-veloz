import { Router } from 'express';
import type { PaymentController } from '../controllers/payment.controller';

export function createPaymentRoutes(controller: PaymentController): Router {
  const router = Router();

  // Consulta por pedido, e nao por id do pagamento: o cliente conhece o
  // pedido, nao o identificador interno gerado pelo servico.
  router.get('/:orderId', controller.getByOrderId);

  return router;
}

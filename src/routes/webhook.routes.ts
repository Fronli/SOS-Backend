import { Router } from 'express';

// Wallet endpoints live under /me (see me.routes.ts). This router only holds the
// payment webhook placeholder so providers can be plugged in later.
const router = Router();

router.post('/:provider', (_req, res) => {
    return res.status(501).json({
        success: false,
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'Webhook payment gateway belum dikonfigurasi.',
    });
});

export default router;

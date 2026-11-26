import { Router } from 'express';
import {
    createPortfolio, deletePortfolio, getMe, getStudentVerification, putInterests,
    putSkills, submitStudentVerification, updateMe, uploadAvatar,
} from '../controllers/me.controller';
import { listMyRequests } from '../controllers/request.controller';
import { getWallet, listTransactions, listBankAccounts, createBankAccount, deleteBankAccount, createTopup, createWithdrawal } from '../controllers/wallet.controller';
import { listNotifications, readAllNotifications, readNotification, registerDevice } from '../controllers/notification.controller';
import { listMyAssignments } from '../controllers/assignment.controller';
import { getHome, getMyPendingCounts } from '../controllers/home.controller';
import { authenticateToken, loadCurrentUser, requireVerified } from '../middlewares/authMiddleware';
import { validate } from '../middlewares/validate.middleware';
import {
    avatarSchema, interestsSchema, portfolioCreateSchema, skillsSchema,
    studentVerificationSchema, updateMeSchema,
} from '../validators/me.validator';
import {
    bankAccountSchema, deviceSchema, listQuerySchema, topupSchema,
    transactionQuerySchema, withdrawalSchema,
} from '../validators/wallet.validator';
import { idParamSchema } from '../validators/common.validator';

const router = Router();

router.use(authenticateToken, loadCurrentUser);

router.get('/', getMe);
router.patch('/', requireVerified, validate({ body: updateMeSchema }), updateMe);
router.put('/interests', requireVerified, validate({ body: interestsSchema }), putInterests);
router.put('/skills', requireVerified, validate({ body: skillsSchema }), putSkills);
router.post('/avatar', requireVerified, validate({ body: avatarSchema }), uploadAvatar);

router.post('/portfolio', requireVerified, validate({ body: portfolioCreateSchema }), createPortfolio);
router.delete('/portfolio/:id', requireVerified, validate({ params: idParamSchema }), deletePortfolio);

router.post('/student-verification', requireVerified, validate({ body: studentVerificationSchema }), submitStudentVerification);
router.get('/student-verification', getStudentVerification);

router.get('/requests', requireVerified, listMyRequests);

router.get('/home', requireVerified, getHome);
router.get('/pending-counts', requireVerified, getMyPendingCounts);

router.get('/assignments', requireVerified, listMyAssignments);

router.get('/wallet', getWallet);
router.get('/transactions', validate({ query: transactionQuerySchema }), listTransactions);
router.post('/topups', requireVerified, validate({ body: topupSchema }), createTopup);
router.post('/withdrawals', requireVerified, validate({ body: withdrawalSchema }), createWithdrawal);
router.get('/bank-accounts', listBankAccounts);
router.post('/bank-accounts', requireVerified, validate({ body: bankAccountSchema }), createBankAccount);
router.delete('/bank-accounts/:id', requireVerified, validate({ params: idParamSchema }), deleteBankAccount);

router.get('/notifications', validate({ query: listQuerySchema }), listNotifications);
router.post('/notifications/read-all', readAllNotifications);
router.post('/notifications/:id/read', validate({ params: idParamSchema }), readNotification);
router.post('/devices', requireVerified, validate({ body: deviceSchema }), registerDevice);

export default router;

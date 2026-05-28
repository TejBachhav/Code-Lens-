import express, { Request, Response } from 'express';
const router = express.Router();

interface Product {
  id: number;
  name: string;
  price: number;
}

router.get('/products', (req: Request, res: Response) => {
  const products: Product[] = [];
  res.json(products);
});

router.get('/products/:id', (req: Request, res: Response) => {
  res.json({ id: parseInt(req.params.id) });
});

router.post('/products', (req: Request, res: Response) => {
  res.status(201).json(req.body);
});

export default router;

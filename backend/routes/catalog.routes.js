import { Router } from "express";
import { getPublicHomeContent, listBanks, listBranches, listBrands, listCarsByBrand } from "../controllers/catalog.controller.js";

const router = Router();

router.get("/brands", listBrands);
router.get("/banks", listBanks);
router.get("/branches", listBranches);
router.get("/home-content", getPublicHomeContent);
router.get("/cars/:brandSlug", listCarsByBrand);

export default router;

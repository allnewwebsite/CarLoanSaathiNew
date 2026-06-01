import { getBanks, getBranches, getBrands, getCarsByBrand, getHomeContent } from "../services/catalog.service.js";

export async function listBrands(_req, res, next) {
  try {
    res.json(await getBrands());
  } catch (error) {
    next(error);
  }
}

export async function listCarsByBrand(req, res, next) {
  try {
    res.json(await getCarsByBrand(req.params.brandSlug));
  } catch (error) {
    next(error);
  }
}

export async function listBanks(_req, res, next) {
  try {
    res.json(await getBanks());
  } catch (error) {
    next(error);
  }
}

export async function listBranches(_req, res, next) {
  try {
    res.json(await getBranches());
  } catch (error) {
    next(error);
  }
}

export async function getPublicHomeContent(_req, res, next) {
  try {
    res.json(await getHomeContent());
  } catch (error) {
    next(error);
  }
}

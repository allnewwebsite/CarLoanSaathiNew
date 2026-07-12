async function prepareHusky() {
  try {
    const { default: husky } = await import("husky");
    husky();
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      console.log("Husky is not installed; skipping Git hook setup.");
      return;
    }
    throw error;
  }
}

await prepareHusky();

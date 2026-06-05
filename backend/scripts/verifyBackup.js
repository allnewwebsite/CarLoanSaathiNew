import { execFileSync } from "node:child_process";

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

function runCapture(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

const project = argValue("project") || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const firestoreUri = argValue("firestore-uri") || process.env.RESTORE_FIRESTORE_URI || process.env.BACKUP_FIRESTORE_URI;
const storageUri = argValue("storage-uri") || process.env.RESTORE_STORAGE_URI || process.env.BACKUP_STORAGE_URI;

if (!project) {
  console.error("Missing --project or FIREBASE_PROJECT_ID.");
  process.exit(1);
}

if (!firestoreUri) {
  console.error("Missing --firestore-uri or BACKUP_FIRESTORE_URI.");
  process.exit(1);
}

const firestoreListing = runCapture("gcloud", ["storage", "ls", firestoreUri]);
const hasExportMetadata = runCapture("gcloud", ["storage", "ls", `${firestoreUri}/**/*.overall_export_metadata`]).length > 0;
const storageListing = storageUri ? runCapture("gcloud", ["storage", "ls", storageUri]).split(/\r?\n/).filter(Boolean).length : 0;

if (!hasExportMetadata) {
  console.error("Backup verification failed: Firestore export metadata was not found.");
  process.exit(1);
}

console.log(JSON.stringify({
  project,
  firestoreUri,
  firestoreListing,
  firestoreExportMetadataFound: true,
  storageUri: storageUri || null,
  storageObjectCountVisible: storageListing,
}, null, 2));

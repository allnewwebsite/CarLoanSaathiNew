import { execFileSync } from "node:child_process";

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

const project = argValue("project") || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const bucket = argValue("bucket") || process.env.BACKUP_BUCKET;
const label = argValue("label") || new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = argValue("backup-root") || process.env.BACKUP_ROOT || "carloansaathi";
const storageBucket = argValue("storage-bucket") || process.env.FIREBASE_STORAGE_BUCKET;
const firestoreUri = argValue("firestore-uri") || (bucket ? `gs://${bucket}/${backupRoot}/firestore/${label}` : "");
const storageUri = argValue("storage-uri") || (bucket ? `gs://${bucket}/${backupRoot}/storage/${label}` : "");

if (!project) {
  console.error("Missing --project or FIREBASE_PROJECT_ID.");
  process.exit(1);
}

if (!firestoreUri) {
  console.error("Missing --bucket/--firestore-uri or BACKUP_BUCKET.");
  process.exit(1);
}

run("gcloud", ["firestore", "export", firestoreUri, "--project", project]);

if (flag("include-storage")) {
  if (!storageBucket) {
    console.error("Missing --storage-bucket or FIREBASE_STORAGE_BUCKET for document backup.");
    process.exit(1);
  }
  run("gcloud", ["storage", "rsync", "-r", `gs://${storageBucket}`, storageUri]);
}

console.log(JSON.stringify({
  project,
  firestoreUri,
  storageUri: flag("include-storage") ? storageUri : null,
  label,
}, null, 2));

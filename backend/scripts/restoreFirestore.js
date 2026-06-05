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
const firestoreUri = argValue("firestore-uri") || process.env.RESTORE_FIRESTORE_URI;
const storageBucket = argValue("storage-bucket") || process.env.FIREBASE_STORAGE_BUCKET;
const storageUri = argValue("storage-uri") || process.env.RESTORE_STORAGE_URI;
const apply = flag("apply") || process.env.RESTORE_APPLY === "true";
const confirmed = process.env.RESTORE_CONFIRM === project;

if (!project) {
  console.error("Missing --project or FIREBASE_PROJECT_ID.");
  process.exit(1);
}

if (!firestoreUri) {
  console.error("Missing --firestore-uri or RESTORE_FIRESTORE_URI.");
  process.exit(1);
}

if (!apply || !confirmed) {
  console.log("Dry run only. To restore, pass --apply and set RESTORE_CONFIRM to the exact project id.");
  console.log(JSON.stringify({ project, firestoreUri, storageUri: storageUri || null }, null, 2));
  process.exit(0);
}

run("gcloud", ["firestore", "import", firestoreUri, "--project", project]);

if (flag("include-storage")) {
  if (!storageBucket || !storageUri) {
    console.error("Missing --storage-bucket/FIREBASE_STORAGE_BUCKET or --storage-uri/RESTORE_STORAGE_URI.");
    process.exit(1);
  }
  run("gcloud", ["storage", "rsync", "-r", storageUri, `gs://${storageBucket}`]);
}

console.log("Restore completed.");

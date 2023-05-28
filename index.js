const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { gzipSync } = require("zlib");
const k8s = require("@kubernetes/client-node");

// Load the Kubernetes configuration from a file
const kc = new k8s.KubeConfig();
kc.loadFromFile("./cronjob-kubeconfig.yaml");

const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const namespace = "database"; // Define the namespace where the logs will be retrieved from

// Define the name of the statefulset to retrieve logs from
const statefulSetName = "postgres"; 

// Define the name of the compressed log file to create, using the statefulset name and the current timestamp.
const compressedLogFilename = `${statefulSetName}-logs-` + new Date().toISOString() + ".gz";

// Create an S3 client with the specified AWS region and access credentials.
const s3 = new S3Client({
  region: "YOUR_REGION", 
  credentials: {
    accessKeyId: 'ACCESS_KEY_ID',
    secretAccessKey: 'SECRET_ACCESS_KEY_ID',
  },
});

// Define the name of the S3 bucket to create and upload the compressed log file to
const bucketName = "postgres-database-logs"; 

// Retrieve logs from all pods in the statefulset
async function retrieveLogs() {
  // Get the statefulset object
  const statefulSet = await k8sApi.readNamespacedStatefulSet(statefulSetName, namespace);

  // Get the labels of the statefulset's pod selector
  const podLabels = statefulSet.body.spec.selector.matchLabels;

  // List the pods in the statefulset with the given labels
  const pods = await coreApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, Object.keys(podLabels).map(key => `${key}=${podLabels[key]}`).join(','));

  // Iterate over the pods and retrieve their logs
  for (const pod of pods.body.items) {
    const logsResponse = await coreApi.readNamespacedPodLog(pod.metadata.name, namespace);
    const compressedLogs = gzipSync(logsResponse.body);
    const uploadParams = {
      Bucket: bucketName,
      Key: `${pod.metadata.name}-${compressedLogFilename}`,
      Body: compressedLogs,
    };
    const uploadCommand = new PutObjectCommand(uploadParams);
    await s3.send(uploadCommand);
    console.log(`Logs for pod ${pod.metadata.name} uploaded to S3 bucket ${bucketName} as ${pod.metadata.name}-${compressedLogFilename}`);
  }
}

retrieveLogs().catch((err) => console.error(err));

# Job Server - Job Definitions Guide

This document describes all available job definitions and how to use them.

## Available Job Definitions

### 1. `echo@1` - Simple Echo Job
**Purpose**: Basic test job that logs messages and completes quickly.

**Parameters**:
```json
{
  "message": "Hello World"
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "echo",
    "definitionVersion": 1,
    "params": {"message": "Test message"}
  }'
```

**Duration**: ~1 second

---

### 2. `encode.video@1` - Video Encoding Simulation
**Purpose**: Simulates CPU-intensive video encoding task with progress tracking.

**Parameters**:
```json
{
  "videoId": "video-123",
  "format": "mp4",        // Optional: mp4, webm, avi (default: mp4)
  "quality": "1080p"      // Optional: 720p, 1080p, 4k (default: 1080p)
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "encode.video",
    "definitionVersion": 1,
    "params": {
      "videoId": "my-video-123",
      "format": "mp4",
      "quality": "4k"
    },
    "priority": 10
  }'
```

**Features**:
- Progress events emitted during encoding
- Cancellation support
- Concurrency limit: 3 concurrent encodings
- Duration: ~10-15 seconds (simulated)

---

### 3. `compute.math@1` - Math Computation
**Purpose**: CPU-intensive mathematical calculations.

**Parameters**:
```json
{
  "operation": "fibonacci",  // sum, product, fibonacci, prime
  "numbers": [30]            // Array of numbers (operation-specific)
}
```

**Operations**:
- `sum`: Sum all numbers in array
- `product`: Multiply all numbers in array
- `fibonacci`: Compute nth Fibonacci number (CPU-intensive)
- `prime`: Check if number is prime (CPU-intensive)

**Example**:
```bash
# Compute 35th Fibonacci number
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "compute.math",
    "definitionVersion": 1,
    "params": {
      "operation": "fibonacci",
      "numbers": [35]
    }
  }'

# Check if number is prime
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "compute.math",
    "definitionVersion": 1,
    "params": {
      "operation": "prime",
      "numbers": [1000003]
    }
  }'
```

**Duration**: Varies by operation (fibonacci/prime are CPU-intensive)

---

### 4. `process.data@1` - Data Processing
**Purpose**: Simulates I/O-bound data processing task.

**Parameters**:
```json
{
  "dataset": "sales-2024",
  "operation": "aggregate"  // aggregate, transform, export
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "process.data",
    "definitionVersion": 1,
    "params": {
      "dataset": "customer-data",
      "operation": "aggregate"
    }
  }'
```

**Duration**: ~2 seconds

---

### 5. `call.api@1` - API Call Simulation
**Purpose**: Simulates external API calls with network delays.

**Parameters**:
```json
{
  "endpoint": "https://api.example.com/users",
  "method": "GET",           // Optional: GET, POST, PUT, DELETE
  "payload": {}             // Optional: Request body for POST/PUT
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "call.api",
    "definitionVersion": 1,
    "params": {
      "endpoint": "https://api.example.com/data",
      "method": "POST",
      "payload": {"userId": 123}
    }
  }'
```

**Features**:
- Network delay simulation
- API response events
- Timeout: 5 minutes
- Duration: ~1 second (simulated)

---

### 6. `process.batch@1` - Batch Processing
**Purpose**: Process multiple items in batches with progress tracking.

**Parameters**:
```json
{
  "items": ["item1", "item2", "item3"],  // Array of items to process
  "batchSize": 10                         // Optional: items per batch (default: 10)
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "process.batch",
    "definitionVersion": 1,
    "params": {
      "items": ["file1", "file2", "file3", "file4", "file5"],
      "batchSize": 2
    }
  }'
```

**Features**:
- Batch progress events
- Cancellation support
- Concurrency limit: 5 concurrent batch jobs
- Duration: ~50ms per item

---

### 7. `failing@1` - Failing Job (Testing)
**Purpose**: Always fails - used for testing retry logic.

**Parameters**: None required

**Example**:
```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "failing",
    "definitionVersion": 1,
    "maxAttempts": 3
  }'
```

**Duration**: Fails immediately

---

## Job Types by Workload

### CPU-Intensive Jobs
- `encode.video` - Video encoding simulation
- `compute.math` - Mathematical computations (fibonacci, prime)

### I/O-Bound Jobs
- `process.data` - Data processing
- `call.api` - API calls

### Mixed Workload Jobs
- `process.batch` - Batch processing with I/O and computation

### Quick Test Jobs
- `echo` - Simple echo/test job
- `failing` - Always fails (for testing)

## Monitoring Job Progress

All jobs emit events that you can query:

```bash
# Get job events
curl http://localhost:3000/v1/jobs/{jobId}/events
```

Some jobs emit custom progress events:
- `encode.video`: Emits `progress` events with encoding steps
- `process.batch`: Emits `batch_progress` events with batch completion status
- `compute.math`: Emits `result` event with computation result
- `call.api`: Emits `api_response` event with API response

## Best Practices

1. **Use appropriate priorities**: High priority for urgent jobs (e.g., user-facing video encoding)
2. **Set idempotency keys**: For jobs that shouldn't be duplicated
3. **Monitor concurrency**: Jobs with `concurrencyLimit` will queue if limit is reached
4. **Handle cancellations**: Long-running jobs should check `ctx.abortSignal.aborted`
5. **Use events for progress**: Emit custom events for long-running jobs

## Example: Complete Video Encoding Workflow

```bash
# 1. Start encoding
RESPONSE=$(curl -s -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "encode.video",
    "definitionVersion": 1,
    "params": {
      "videoId": "my-video-123",
      "format": "mp4",
      "quality": "1080p"
    },
    "priority": 10,
    "idempotencyKey": "encode-video-123"
  }')

JOB_ID=$(echo $RESPONSE | jq -r '.jobId')
echo "Job ID: $JOB_ID"

# 2. Monitor progress
while true; do
  STATUS=$(curl -s http://localhost:3000/v1/jobs/$JOB_ID | jq -r '.status')
  echo "Status: $STATUS"
  
  if [ "$STATUS" != "running" ] && [ "$STATUS" != "queued" ]; then
    break
  fi
  
  sleep 2
done

# 3. Get events
curl -s http://localhost:3000/v1/jobs/$JOB_ID/events | jq '.events[]'
```


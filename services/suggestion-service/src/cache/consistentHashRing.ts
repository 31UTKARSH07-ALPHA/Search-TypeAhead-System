import { createHash } from "node:crypto";

interface RingPoint {
  hash: bigint;
  bucket: string;
}

export interface ConsistentHashRingOptions {
  bucketCount: number;
  virtualNodeCount: number;
}

export class ConsistentHashRing {
  private readonly points: RingPoint[];

  public constructor(options: ConsistentHashRingOptions) {
    if (options.bucketCount <= 0) {
      throw new Error("Hash ring bucket count must be positive");
    }

    if (options.virtualNodeCount <= 0) {
      throw new Error("Hash ring virtual node count must be positive");
    }

    const buckets = Array.from({ length: options.bucketCount }, (_value, index) => `node${index}`);
    this.points = buckets
      .flatMap((bucket) =>
        Array.from({ length: options.virtualNodeCount }, (_value, index) => ({
          bucket,
          hash: hashToBigInt(`${bucket}:${index}`)
        }))
      )
      .sort((left, right) => compareBigInt(left.hash, right.hash));
  }

  public getBucket(key: string): string {
    const hash = hashToBigInt(key);
    const pointIndex = this.findPointIndex(hash);

    return this.points[pointIndex]?.bucket ?? this.points[0].bucket;
  }

  private findPointIndex(hash: bigint): number {
    let low = 0;
    let high = this.points.length - 1;
    let result = 0;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const middleHash = this.points[middle].hash;

      if (middleHash >= hash) {
        result = middle;
        high = middle - 1;
      } else {
        low = middle + 1;
      }
    }

    return low > this.points.length - 1 ? 0 : result;
  }
}

function hashToBigInt(value: string): bigint {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return BigInt(`0x${digest}`);
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

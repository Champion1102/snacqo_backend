import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';

const { cloudName, apiKey, apiSecret } = config.cloudinary;

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
}

export interface UploadResult {
  url: string;
  publicId: string;
}

/**
 * Upload a buffer to Cloudinary. Returns secure URL.
 * Folder is optional (e.g. "snacqo/products").
 */
export async function uploadImage(
  buffer: Buffer,
  options?: { folder?: string; publicId?: string }
): Promise<UploadResult> {
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_* env vars.');
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options?.folder ?? 'snacqo/products',
        resource_type: 'image',
        ...(options?.publicId ? { public_id: options.publicId } : {}),
      },
      (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        if (!result?.secure_url) {
          reject(new Error('Cloudinary upload did not return a URL'));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id ?? '',
        });
      }
    );
    uploadStream.end(buffer);
  });
}

/**
 * Upload a video buffer to Cloudinary. Returns secure URL.
 */
export async function uploadVideo(
  buffer: Buffer,
  options?: { folder?: string; publicId?: string }
): Promise<UploadResult> {
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_* env vars.');
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options?.folder ?? 'snacqo/reviews',
        resource_type: 'video',
        ...(options?.publicId ? { public_id: options.publicId } : {}),
      },
      (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        if (!result?.secure_url) {
          reject(new Error('Cloudinary upload did not return a URL'));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id ?? '',
        });
      }
    );
    uploadStream.end(buffer);
  });
}

/**
 * Delete an image by public_id (optional – e.g. when deleting product image).
 */
export async function deleteImage(publicId: string): Promise<void> {
  if (!cloudName || !apiKey || !apiSecret) return;
  await cloudinary.uploader.destroy(publicId);
}

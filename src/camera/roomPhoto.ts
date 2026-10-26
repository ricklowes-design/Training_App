import { ROOM_H, ROOM_W } from './roomCheck';
import { captureFrame, grayAt, listCameras, preferredCamera } from './session';
import type { RoomProfile } from '../db/types';

/** The room photo fields of a profile, taken from the live webcam picture (kept on this Chromebook only). */
export async function roomPhotoFields(video: HTMLVideoElement, savedDeviceId?: string): Promise<Pick<RoomProfile, 'backgroundFrame' | 'backgroundThumb' | 'cameraFingerprint' | 'deviceId'>> {
  const f = await captureFrame(video);
  const grey = grayAt(video, ROOM_W, ROOM_H);
  const cam = preferredCamera(await listCameras(), savedDeviceId);
  let h = 0;
  for (const ch of cam?.label ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { backgroundFrame: f.blob, backgroundThumb: Array.from(grey.data), cameraFingerprint: { deviceLabelHash: h.toString(16), width: f.width, height: f.height }, deviceId: cam?.deviceId };
}

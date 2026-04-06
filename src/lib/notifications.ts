// إشعارات الويب + إشعارات أندرويد/آيفون (محلية + تسجيل FCM للبث من السيرفر)
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { apiUrl } from './apiBase';

const NOTIFICATION_SOUND_URL = 'https://www.myinstants.com/media/sounds/apple-original.mp3';
const ANDROID_CHANNEL = 'saraf_default';

let localNotifId = 10000;

function notificationsPreferenceOn(): boolean {
  return localStorage.getItem('notifications_enabled') !== 'false';
}

class NotificationService {
  private audio: HTMLAudioElement | null = null;
  private enabled = false;
  private nativeListenersAttached = false;

  constructor() {
    this.audio = new Audio(NOTIFICATION_SOUND_URL);
    this.audio.volume = 0.5;
    const saved = localStorage.getItem('notifications_enabled');
    this.enabled = saved === 'true' || saved === null;
  }

  /** إزالة رمز FCM من السيرفر + إلغاء الإشعارات المحلية المعلّقة (عند إطفاء الإشعارات) */
  async unregisterNativePush(clientId: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await fetch(apiUrl('/api/push/unregister'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
    } catch (e) {
      console.error('push unregister:', e);
    }
    try {
      const pending = await LocalNotifications.getPending();
      const list = pending.notifications ?? [];
      if (list.length > 0) {
        await LocalNotifications.cancel({
          notifications: list.map((n) => ({ id: n.id })),
        });
      }
    } catch (e) {
      console.error('LocalNotifications.cancel pending:', e);
    }
    try {
      await PushNotifications.removeAllDeliveredNotifications();
    } catch (e) {
      console.error('PushNotifications.removeAllDeliveredNotifications:', e);
    }
  }

  /** تسجيل FCM وقناة أندرويد — يُستدعى بعد جاهزية العميل (مرة على التطبيق الأصلي) */
  async initNativePush(clientId: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    if (!notificationsPreferenceOn()) {
      await this.unregisterNativePush(clientId);
      return;
    }
    try {
      if (Capacitor.getPlatform() === 'android') {
        await LocalNotifications.createChannel({
          id: ANDROID_CHANNEL,
          name: 'Saraf IQ',
          description: 'الطلبات والتنبيهات والعروض',
          importance: 5,
          vibration: true,
        });
      }

      const pushPerm = await PushNotifications.requestPermissions();
      if (pushPerm.receive === 'granted') {
        await PushNotifications.register();
      }

      await LocalNotifications.requestPermissions();

      if (!this.nativeListenersAttached) {
        this.nativeListenersAttached = true;
        PushNotifications.addListener('registration', async (t) => {
          if (!notificationsPreferenceOn()) return;
          const token = t.value;
          if (!token) return;
          try {
            await fetch(apiUrl('/api/push/register'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token,
                client_id: clientId,
                platform: Capacitor.getPlatform(),
              }),
            });
          } catch (e) {
            console.error('push register:', e);
          }
        });
        PushNotifications.addListener('registrationError', (err) => {
          console.error('Push registrationError:', err);
        });
      }
    } catch (e) {
      console.error('initNativePush:', e);
    }
  }

  async requestPermission(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const loc = await LocalNotifications.requestPermissions();
      const push = await PushNotifications.requestPermissions();
      const ok = loc.display === 'granted' || push.receive === 'granted';
      this.enabled = ok;
      localStorage.setItem('notifications_enabled', String(ok));
      return ok;
    }

    if (!('Notification' in window)) {
      console.log('This browser does not support notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      this.enabled = true;
      localStorage.setItem('notifications_enabled', 'true');
      return true;
    }

    if (Notification.permission === 'denied') {
      return false;
    }

    const permission = await Notification.requestPermission();
    this.enabled = permission === 'granted';
    localStorage.setItem('notifications_enabled', String(this.enabled));
    return this.enabled;
  }

  isEnabled(): boolean {
    if (Capacitor.isNativePlatform()) {
      return this.enabled && notificationsPreferenceOn();
    }
    return this.enabled && Notification.permission === 'granted';
  }

  async sendNotification(title: string, options?: NotificationOptions & { playSound?: boolean }) {
    const { playSound = true, ...notificationOptions } = options || {};

    if (Capacitor.isNativePlatform()) {
      if (!this.enabled || !notificationsPreferenceOn()) return;
      try {
        const id = (localNotifId++ % 2147480000) + 1;
        const body =
          typeof notificationOptions.body === 'string' ? notificationOptions.body : '';
        await LocalNotifications.schedule({
          notifications: [
            {
              title,
              body,
              id,
              ...(Capacitor.getPlatform() === 'android' ? { channelId: ANDROID_CHANNEL } : {}),
              schedule: { at: new Date(Date.now() + 120) },
            },
          ],
        });
      } catch (e) {
        console.error('LocalNotifications.schedule:', e);
      }
      return;
    }

    if (playSound && this.audio) {
      try {
        this.audio.currentTime = 0;
        await this.audio.play();
      } catch {
        /* يتطلب تفاعلاً أحياناً */
      }
    }

    if (this.enabled && Notification.permission === 'granted') {
      try {
        const notification = new Notification(title, {
          icon: '/icons/logo.png',
          badge: '/icons/logo.png',
          tag: 'saraf-iq',
          requireInteraction: false,
          ...notificationOptions,
        });

        notification.onclick = () => {
          window.focus();
          notification.close();
        };

        setTimeout(() => notification.close(), 5000);
      } catch (e) {
        console.log('Notification failed:', e);
      }
    }
  }

  notifyTransactionComplete(orderRef: string, amount: string) {
    void this.sendNotification('تم إكمال الطلب! ✅', {
      body: `طلبك #${orderRef} بمبلغ ${amount} تم بنجاح`,
      icon: '/icons/logo.png',
      tag: `tx-complete-${orderRef}`,
    });
  }

  notifyTransactionFailed(orderRef: string) {
    void this.sendNotification('فشل الطلب ❌', {
      body: `لم نتمكن من إكمال طلبك #${orderRef}. يرجى المحاولة مرة أخرى.`,
      icon: '/icons/logo.png',
      tag: `tx-failed-${orderRef}`,
    });
  }

  /** للويب: تغيّر حالة الطلب (على التطبيق الأصلي يُرسل السيرفر FCM) */
  notifyTransactionStatusChange(
    status: 'completed' | 'failed' | 'refunded' | 'suspended' | 'retry_otp',
    orderRef: string,
    amountLabel?: string,
  ) {
    if (status === 'completed' && amountLabel) {
      this.notifyTransactionComplete(orderRef, amountLabel);
      return;
    }
    if (status === 'failed') {
      this.notifyTransactionFailed(orderRef);
      return;
    }
    const map: Record<string, { title: string; body: string }> = {
      refunded: {
        title: 'استرجاع ↩️',
        body: `تم تسجيل الاسترجاع للطلب #${orderRef}.`,
      },
      suspended: {
        title: 'طلب معلّق ⏸',
        body: `طلبك #${orderRef} في حالة تعليق.`,
      },
      retry_otp: {
        title: 'تحقق من الرمز',
        body: `أعد إدخال رمز التحقق للطلب #${orderRef}.`,
      },
    };
    const m = map[status];
    if (m) {
      void this.sendNotification(m.title, {
        body: m.body,
        icon: '/icons/logo.png',
        tag: `tx-${status}-${orderRef}`,
      });
    }
  }

  notifyNewMessage(title: string, message: string) {
    void this.sendNotification(title, {
      body: message,
      icon: '/icons/logo.png',
      tag: 'new-message',
    });
  }

  toggle(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem('notifications_enabled', String(enabled));
  }
}

export const notificationService = new NotificationService();

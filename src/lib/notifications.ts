// Notification service with sound and browser notifications

// Simple notification beep sound (using a reliable CDN)
const NOTIFICATION_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

class NotificationService {
  private audio: HTMLAudioElement | null = null;
  private enabled = false;

  constructor() {
    // Initialize audio
    this.audio = new Audio(NOTIFICATION_SOUND_URL);
    this.audio.volume = 0.5;
    
    // Check saved preference
    const saved = localStorage.getItem('notifications_enabled');
    this.enabled = saved === 'true';
  }

  async requestPermission(): Promise<boolean> {
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
    return this.enabled && Notification.permission === 'granted';
  }

  async sendNotification(title: string, options?: NotificationOptions & { playSound?: boolean }) {
    const { playSound = true, ...notificationOptions } = options || {};

    // Play sound
    if (playSound && this.audio) {
      try {
        this.audio.currentTime = 0;
        await this.audio.play();
      } catch (e) {
        console.log('Audio play failed:', e);
      }
    }

    // Show browser notification
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

        // Auto close after 5 seconds
        setTimeout(() => notification.close(), 5000);
      } catch (e) {
        console.log('Notification failed:', e);
      }
    }
  }

  // Transaction status notifications
  notifyTransactionComplete(orderRef: string, amount: string) {
    this.sendNotification('تم إكمال الطلب! ✅', {
      body: `طلبك #${orderRef} بمبلغ ${amount} تم بنجاح`,
      icon: '/icons/logo.png',
      tag: `tx-complete-${orderRef}`,
    });
  }

  notifyTransactionFailed(orderRef: string) {
    this.sendNotification('فشل الطلب ❌', {
      body: `لم نتمكن من إكمال طلبك #${orderRef}. يرجى المحاولة مرة أخرى.`,
      icon: '/icons/logo.png',
      tag: `tx-failed-${orderRef}`,
    });
  }

  notifyNewMessage(title: string, message: string) {
    this.sendNotification(title, {
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

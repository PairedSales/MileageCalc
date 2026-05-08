import { parseRateLimitHeaders } from './rateLimitParser.js';

export class QuotaService {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.state = {
      quotaAvailable: false,
      totalQuota: null,
      remainingQuota: null,
      resetTime: null,
      estimatedJobCost: 0,
      quotaStatus: 'Unknown',
      lastUpdated: null,
      exhausted: false,
      loading: true
    };
  }


  setLoading(loading) {
    this.state.loading = loading;
    this.emit();
  }

  resetQuota() {
    this.state.quotaAvailable = false;
    this.state.totalQuota = null;
    this.state.remainingQuota = null;
    this.state.resetTime = null;
    this.state.lastUpdated = null;
    this.state.exhausted = false;
    this.state.loading = false;
    this.state.quotaStatus = this.getStatus();
    this.emit();
  }

  setEstimate(estimatedJobCost) {
    this.state.estimatedJobCost = Math.max(0, Number(estimatedJobCost) || 0);
    this.state.quotaStatus = this.getStatus();
    this.emit();
  }

  updateFromResponse(res) {
    const parsed = parseRateLimitHeaders(res.headers);
    if (parsed.quotaAvailable) {
      this.state.quotaAvailable = true;
      this.state.totalQuota = parsed.totalQuota;
      this.state.remainingQuota = parsed.remainingQuota;
      this.state.resetTime = parsed.resetTime;
      this.state.lastUpdated = new Date();
    }
    if (res.status === 429) {
      this.state.exhausted = true;
      if (this.state.remainingQuota === null) this.state.remainingQuota = 0;
    }
    this.state.loading = false;
    this.state.quotaStatus = this.getStatus();
    this.emit();
  }

  getStatus() {
    if (this.state.exhausted || this.state.remainingQuota === 0) return 'Exhausted';
    if (!this.state.quotaAvailable || this.state.remainingQuota === null || this.state.totalQuota === null) return 'Unknown';
    const pct = (this.state.remainingQuota / this.state.totalQuota) * 100;
    if (pct > 50) return 'Healthy';
    if (pct >= 20) return 'Warning';
    return 'Critical';
  }

  emit() { this.onUpdate?.({ ...this.state }); }
}

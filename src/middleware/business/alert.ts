import { PeerInfo } from '../../types/peer'
import Middleware, { MiddlewareCallback, Pipelines, MiddlewareServices } from '../../types/middleware'
import { IlpPrepare, Errors as IlpPacketErrors, IlpReply, isFulfill } from 'ilp-packet'
// import { create as createLogger } from '../common/log'
// const log = createLogger('alert-middleware')

const { T04_INSUFFICIENT_LIQUIDITY } = IlpPacketErrors.codes

export interface Alert {
  id: number
  peerId: string
  triggeredBy: string
  message: string
  count: number
  createdAt: Date
  updatedAt: Date
}

export interface AlertMiddlewareServices extends MiddlewareServices {
  peerInfo: PeerInfo
}

export default class AlertMiddleware implements Middleware {
  private alerts: { [id: number]: Alert } = {}
  private nextAlertId: number = Date.now()
  private peerInfo: PeerInfo

  constructor ({ peerInfo }: AlertMiddlewareServices) {
    this.peerInfo = peerInfo
  }

  async applyToPipelines (pipelines: Pipelines) {
    pipelines.outgoingData.insertLast({
      name: 'alert',
      method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
        const result = await next(packet)
        if (isFulfill(result)) return result

        if (result.code !== T04_INSUFFICIENT_LIQUIDITY) return result

        // The peer rejected a packet which, according to the local balance, should
        // have succeeded. This can happen when our local connector owes the peer
        // money but restarted before it was settled.
        if (result.message !== 'exceeded maximum balance.') return result

        const { triggeredBy } = result
        // log.warn('generating alert for account=%s triggeredBy=%s message="%s"', this.peerInfo.id, triggeredBy, result.message)
        this.addAlert(this.peerInfo.id, triggeredBy, result.message)

        return result
      }
    })
  }

  getAlerts (): Alert[] {
    return Object.keys(this.alerts)
      .map((id) => this.alerts[id])
      .sort((a, b) => a.id - b.id)
  }

  dismissAlert (id: number) {
    delete this.alerts[id]
  }

  private addAlert (peerId: string, triggeredBy: string, message: string) {
    const alert = Object.keys(this.alerts)
      .map((alertId) => this.alerts[alertId])
      .find((alert) =>
        alert.peerId === peerId &&
        alert.triggeredBy === triggeredBy &&
        alert.message === message)
    if (alert) {
      alert.count++
      alert.updatedAt = new Date()
      return
    }

    const id = this.nextAlertId++
    const now = new Date()
    this.alerts[id] = {
      id,
      peerId,
      triggeredBy,
      message,
      count: 1,
      createdAt: now,
      updatedAt: now
    }
  }
}

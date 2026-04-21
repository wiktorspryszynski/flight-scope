import { useEffect, useRef } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScenegraphLayer } from '@deck.gl/mesh-layers'
import type { MapRef } from 'react-map-gl/maplibre'

const MODEL_URL = new URL('../assets/models/airbus_a319.glb', import.meta.url).href

export type AnimatedPosition = { longitude: number; latitude: number; heading: number }

const DISPLAY_ALTITUDE_M = 800
const MODEL_SCALE = 3

type PlaneData = {
  position: [number, number, number]
  orientation: [number, number, number]
}

type Props = {
  mapRef: React.RefObject<MapRef | null>
  positionRef: { current: AnimatedPosition }
}

export function PlaneScenegraphLayer({ mapRef, positionRef }: Props) {
  const overlayRef = useRef<MapboxOverlay | null>(null)

  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const overlay = new MapboxOverlay({ layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay

    let rafId: number

    const tick = () => {
      const { longitude, latitude, heading } = positionRef.current
      const data: PlaneData[] = [
        {
          position: [longitude, latitude, DISPLAY_ALTITUDE_M],
          orientation: [0, 0, heading - 90],
        },
      ]
      overlay.setProps({
        layers: [
          new ScenegraphLayer({
            id: 'plane-scenegraph',
            data,
            scenegraph: MODEL_URL,
            getPosition: (d: PlaneData) => d.position,
            getOrientation: (d: PlaneData) => d.orientation,
            sizeScale: MODEL_SCALE,
            _lighting: 'flat',
          }),
        ],
      })
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      map.removeControl(overlay as unknown as maplibregl.IControl)
      overlayRef.current = null
    }
  }, [mapRef, positionRef])

  return null
}

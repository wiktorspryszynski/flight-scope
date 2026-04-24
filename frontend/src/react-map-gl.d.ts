declare module "react-map-gl" {
  import { ComponentType, CSSProperties, ReactNode } from "react";

  interface MapProps {
    mapLib?: unknown;
    initialViewState?: {
      longitude: number;
      latitude: number;
      zoom: number;
      pitch?: number;
      bearing?: number;
    };
    style?: CSSProperties;
    mapStyle?: string;
    children?: ReactNode;
  }

  const Map: ComponentType<MapProps>;
  export default Map;
}
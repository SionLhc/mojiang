/** 雷达图的一个轴 */
export interface RadarAxis {
    label: string;
    /** 本章数值 */
    value: number;
    /** 基线均值，没有基线时为参考值 */
    reference: number;
}

/** 雷达图属性 */
interface RadarChartProps {
    axes: RadarAxis[];
    size?: number;
}

/**
 * 六维雷达图
 * 自己去画 SVG，不引图表库：六个点一个多边形，简单到不值得加依赖。
 */
export default function RadarChart({ axes, size = 210 }: RadarChartProps) {
    const center = size / 2;
    const radius = center - 34;
    const count = axes.length;

    /**
     * 把第 index 个轴上的比例换算成坐标
     * @param index 轴序号
     * @param ratio 0-1 比例
     * @returns 坐标
     */
    function pointAt(index: number, ratio: number): { x: number; y: number } {
        // 从正上方开始，顺时针铺开
        const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
        return {
            x: center + Math.cos(angle) * radius * ratio,
            y: center + Math.sin(angle) * radius * ratio,
        };
    }

    /**
     * 把数值归一化到 0-1
     * 用"参考值的两倍"当上限，这样基线永远落在半径一半的位置，不同维度可比
     * @param value 数值
     * @param reference 参考值
     * @returns 0-1
     */
    function normalize(value: number, reference: number): number {
        const ceiling = Math.max(reference * 2, 1);
        return Math.max(0, Math.min(1, value / ceiling));
    }

    /**
     * 把一组比例串成多边形点串
     * @param ratios 比例数组
     * @returns points 属性
     */
    function polygon(ratios: number[]): string {
        return ratios
            .map((ratio, index) => {
                const point = pointAt(index, Math.max(ratio, 0.02));
                return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
            })
            .join(' ');
    }

    const referenceRatios = axes.map((axis) => normalize(axis.reference, axis.reference));
    const valueRatios = axes.map((axis) => normalize(axis.value, axis.reference));

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto block">
            {/* 背景网格：25% / 50% / 75% / 100% */}
            {[0.25, 0.5, 0.75, 1].map((ratio) => (
                <polygon
                    key={ratio}
                    points={polygon(axes.map(() => ratio))}
                    fill="none"
                    stroke="#e2d6b7"
                    strokeWidth={1}
                />
            ))}

            {/* 轴线 */}
            {axes.map((axis, index) => {
                const point = pointAt(index, 1);
                return (
                    <line
                        key={axis.label}
                        x1={center}
                        y1={center}
                        x2={point.x}
                        y2={point.y}
                        stroke="#e2d6b7"
                        strokeWidth={1}
                    />
                );
            })}

            {/* 基线参考（虚线） */}
            <polygon
                points={polygon(referenceRatios)}
                fill="none"
                stroke="#d6c8a4"
                strokeWidth={1}
                strokeDasharray="3 3"
            />

            {/* 本章数值 */}
            <polygon
                points={polygon(valueRatios)}
                fill="rgba(31, 122, 92, 0.16)"
                stroke="#1f7a5c"
                strokeWidth={1.6}
            />
            {valueRatios.map((ratio, index) => {
                const point = pointAt(index, Math.max(ratio, 0.02));
                return <circle key={axes[index].label} cx={point.x} cy={point.y} r={2.4} fill="#1f7a5c" />;
            })}

            {/* 轴标签 */}
            {axes.map((axis, index) => {
                const point = pointAt(index, 1.22);
                return (
                    <text
                        key={axis.label}
                        x={point.x}
                        y={point.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#6e5f42"
                        fontSize={10}
                    >
                        {axis.label}
                    </text>
                );
            })}
        </svg>
    );
}

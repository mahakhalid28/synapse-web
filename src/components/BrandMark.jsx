// The supplied dark tile keeps the white-and-blue mark visible in every theme.
// Nearby visible text supplies the accessible brand name.
export default function BrandMark({ size = 38, className = "" }) {
  return (
    <img
      aria-hidden="true"
      alt=""
      src={`${import.meta.env.BASE_URL}assets/brand/app/app-icon.svg`}
      width={size}
      height={size}
      className={`block shrink-0 rounded-[25%] ${className}`}
    />
  );
}

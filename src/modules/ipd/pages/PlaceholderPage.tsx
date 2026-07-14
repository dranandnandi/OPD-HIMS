interface Props {
  title: string;
  description: string;
}

export default function PlaceholderPage({ title, description }: Props) {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-800 mb-2">{title}</h1>
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-sm text-slate-500">
        {description}
      </div>
    </div>
  );
}

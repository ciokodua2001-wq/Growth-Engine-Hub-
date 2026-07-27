import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Globe, MapPin, GraduationCap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useLocation } from "wouter";

const COUNTRIES = [
  "Canada", "United States", "United Kingdom", "Australia",
  "New Zealand", "India", "Nigeria", "South Africa",
  "Philippines", "Other",
];

const CA_PROVINCES = [
  "Alberta", "British Columbia", "Manitoba", "New Brunswick",
  "Newfoundland and Labrador", "Nova Scotia", "Ontario",
  "Prince Edward Island", "Quebec", "Saskatchewan",
  "Northwest Territories", "Nunavut", "Yukon",
];

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
  "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York",
  "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming",
];

const GRADES = [
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
];

interface Step {
  id: string;
  title: string;
  subtitle: string;
  icon: typeof Globe;
}

const STEPS: Step[] = [
  { id: "country", title: "Where are you studying?", subtitle: "Z will align its teaching to your local curriculum.", icon: Globe },
  { id: "province", title: "Which province or state?", subtitle: "This helps Z understand your specific curriculum standards.", icon: MapPin },
  { id: "grade", title: "What grade are you in?", subtitle: "Z will match its language and complexity to your level.", icon: GraduationCap },
];

export default function Onboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [selections, setSelections] = useState({ country: "", province: "", grade: "" });
  const [saving, setSaving] = useState(false);

  const currentStep = STEPS[step];
  const showProvinceStep = ["Canada", "United States"].includes(selections.country);
  const effectiveSteps = showProvinceStep ? STEPS : [STEPS[0], STEPS[2]];
  const effectiveStep = effectiveSteps[step];

  const getOptions = () => {
    if (effectiveStep.id === "country") return COUNTRIES;
    if (effectiveStep.id === "province") {
      return selections.country === "Canada" ? CA_PROVINCES : US_STATES;
    }
    return GRADES;
  };

  const handleSelect = (value: string) => {
    setSelections((prev) => ({ ...prev, [effectiveStep.id]: value }));
  };

  const handleNext = async () => {
    if (step < effectiveSteps.length - 1) {
      setStep((s) => s + 1);
    } else {
      setSaving(true);
      try {
        await apiFetch("/z/profile", {
          method: "PUT",
          body: JSON.stringify({
            country: selections.country || null,
            province: selections.province || null,
            grade: selections.grade,
          }),
        });
        navigate("/");
      } catch (err) {
        console.error("Failed to save profile", err);
        setSaving(false);
      }
    }
  };

  const selected = selections[effectiveStep.id as keyof typeof selections];
  const options = getOptions();
  const isLast = step === effectiveSteps.length - 1;

  return (
    <div className="min-h-screen bg-[#080B14] text-white flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-12">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-900/40">
          Z
        </div>
        <span className="text-white/60 text-sm tracking-widest uppercase">Quantivarian</span>
      </div>

      {/* Progress dots */}
      <div className="flex gap-2 mb-10">
        {effectiveSteps.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === step ? "w-8 bg-indigo-500" : i < step ? "w-4 bg-indigo-700" : "w-4 bg-white/10"
            }`}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.25 }}
          className="w-full max-w-md"
        >
          {/* Step header */}
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-indigo-900/60 border border-indigo-700/30 flex items-center justify-center">
              <effectiveStep.icon className="w-4 h-4 text-indigo-400" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">{effectiveStep.title}</h2>
          <p className="text-white/40 text-sm mb-6">{effectiveStep.subtitle}</p>

          {/* Options */}
          <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                className={`px-4 py-3 rounded-lg text-sm text-left transition-all font-medium border ${
                  selected === opt
                    ? "bg-indigo-600/30 border-indigo-500 text-indigo-200"
                    : "bg-white/[0.03] border-white/5 text-white/60 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      <button
        onClick={handleNext}
        disabled={!selected || saving}
        className="mt-8 flex items-center gap-2 px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl font-medium transition-colors"
      >
        {saving ? "Saving..." : isLast ? "Start learning" : "Continue"}
        {!saving && <ChevronRight className="w-4 h-4" />}
      </button>
    </div>
  );
}

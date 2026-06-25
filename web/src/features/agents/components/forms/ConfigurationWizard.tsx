import React, { useState } from "react";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Badge } from "../ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Settings,
  Package,
  Info,
} from "@/src/features/agents/components/ui/icon-bridge";
import { ConfigurationForm } from "./ConfigurationForm";
import type {
  ConfigurationSchema,
  AgentConfiguration,
  AgentPackage,
} from "../../types/agents";

interface ConfigurationWizardProps {
  package: AgentPackage;
  schema: ConfigurationSchema;
  initialValues?: AgentConfiguration;
  onComplete: (configuration: AgentConfiguration) => Promise<void>;
  onCancel?: () => void;
}

export const ConfigurationWizard: React.FC<ConfigurationWizardProps> = ({
  package: pkg,
  schema,
  initialValues,
  onComplete,
  onCancel,
}) => {
  const fields = schema.fields ?? [];
  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const [configuration, setConfiguration] = useState<AgentConfiguration>(
    initialValues || {},
  );

  const steps = [
    {
      title: "Package Overview",
      description: "Review the agent package details",
      icon: Package,
    },
    {
      title: "Configuration",
      description: "Set up the agent configuration",
      icon: Settings,
    },
    {
      title: "Review & Complete",
      description: "Review your settings and complete setup",
      icon: Check,
    },
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleConfigurationSubmit = async (config: AgentConfiguration) => {
    setConfiguration(config);
    handleNext();
  };

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      await onComplete(configuration);
    } catch (error) {
      // Error handling is done in the parent component
      console.error("Configuration completion failed:", error);
    } finally {
      setIsCompleting(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="bg-muted rounded-lg p-3">
                <Package className="text-foreground h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-heading-3">{pkg.name}</h3>
                <p className="mt-1 text-gray-600">{pkg.description}</p>
                <div className="mt-3 flex items-center gap-4 text-sm text-gray-500">
                  <span>Version: {pkg.version}</span>
                  <span>Author: {pkg.author}</span>
                </div>
              </div>
            </div>

            {pkg.tags && pkg.tags.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium">Tags</h4>
                <div className="flex flex-wrap gap-2">
                  {pkg.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-muted border-border rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <Info className="text-foreground mt-0.5 h-5 w-5" />
                <div>
                  <h4 className="text-foreground text-sm font-medium">
                    Configuration Required
                  </h4>
                  <p className="text-muted-foreground mt-1 text-sm">
                    This agent requires {fields.length} configuration field
                    {fields.length !== 1 ? "s" : ""} to be set up before it can
                    run.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <ConfigurationForm
            schema={{ ...schema, fields }}
            initialValues={configuration}
            onSubmit={handleConfigurationSubmit}
            title=""
            description=""
          />
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-start gap-3">
                <Check className="mt-0.5 h-5 w-5 text-green-600" />
                <div>
                  <h4 className="text-sm font-medium text-green-900">
                    Configuration Complete
                  </h4>
                  <p className="mt-1 text-sm text-green-700">
                    Your agent is configured and ready to start.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-medium">
                Configuration Summary
              </h4>
              <div className="space-y-2">
                {fields.map((field) => (
                  <div
                    key={field.name}
                    className="flex items-center justify-between border-b border-gray-100 py-2"
                  >
                    <span className="text-sm font-medium">{field.name}</span>
                    <span className="text-sm text-gray-600">
                      {field.type === "secret"
                        ? "••••••••"
                        : field.type === "boolean"
                          ? configuration[field.name]
                            ? "Enabled"
                            : "Disabled"
                          : configuration[field.name] || "Not set"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Step Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;

            return (
              <div key={index} className="flex items-center">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${
                    isCompleted
                      ? "border-green-500 bg-green-500 text-white"
                      : isActive
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-gray-300 bg-gray-100 text-gray-400"
                  }`}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                <div className="ml-3">
                  <p
                    className={`text-sm font-medium ${isActive ? "text-foreground" : isCompleted ? "text-green-600" : "text-gray-500"}`}
                  >
                    {step.title}
                  </p>
                  <p className="text-xs text-gray-500">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`mx-4 h-0.5 flex-1 ${isCompleted ? "bg-green-500" : "bg-gray-200"}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <Card>
        <CardHeader>
          <CardTitle>{steps[currentStep].title}</CardTitle>
          <CardDescription>{steps[currentStep].description}</CardDescription>
        </CardHeader>
        <CardContent>{renderStepContent()}</CardContent>
      </Card>

      {/* Navigation */}
      {currentStep !== 1 && (
        <div className="mt-6 flex justify-between">
          <Button
            variant="outline"
            onClick={currentStep === 0 ? onCancel : handlePrevious}
            disabled={isCompleting}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            {currentStep === 0 ? "Cancel" : "Previous"}
          </Button>

          <Button
            onClick={
              currentStep === steps.length - 1 ? handleComplete : handleNext
            }
            disabled={isCompleting}
          >
            {currentStep === steps.length - 1 ? (
              isCompleting ? (
                "Completing..."
              ) : (
                "Complete Setup"
              )
            ) : (
              <>
                Next
                <ChevronRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
};

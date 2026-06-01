export const supportCPUAndMemoryHotplug = (vm: any): boolean => {
  if (!vm || !vm.metadata || !vm.metadata.annotations) {
    return false;
  }
  const annotation = vm.metadata.annotations['harvesterhci.io/enableCPUAndMemoryHotplug'];
  return annotation && annotation.toLowerCase() === 'true';
};

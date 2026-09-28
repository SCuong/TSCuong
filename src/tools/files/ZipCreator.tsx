import { ToolStack } from '@/components/tool/EditorPanel';
import { CreateMode } from './ZipTool';

export default function ZipCreator() {
  return (
    <ToolStack>
      <CreateMode />
    </ToolStack>
  );
}

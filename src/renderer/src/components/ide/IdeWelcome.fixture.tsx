import { defineFixture } from '../../component-fixtures/component-fixture'
import IdeWelcome from './IdeWelcome'

export const empty = defineFixture({
  width: 1100,
  render: () => (
    <div className="flex h-[720px] w-full">
      <IdeWelcome />
    </div>
  )
})

import { getRepository } from 'typeorm'
import { filter } from 'lodash'

import config from 'config'
import { ValidatorInfoEntity } from 'orm'

import * as lcd from 'lib/lcd'
import { sortDenoms } from 'lib/common'
import { div, plus } from 'lib/math'
import memoizeCache from 'lib/memoizeCache'

import { getBalance } from 'service/bank'
import { getAirdropAnnualAvgReturn } from 'service/dashboard'

import { getValidatorAnnualAvgReturn } from './getValidatorReturn'
import { getCommissions, getMyDelegation, getUndelegateSchedule, generateValidatorResponse } from './helper'

interface RewardsByDenom {
  denom: string
  amount: string
  adjustedAmount: string
}

interface ValidatorDetailsReturn extends ValidatorResponse {
  commissions?: Coin[]
  myDelegation?: string
  myDelegatable?: string
  myUndelegation?: UndeligationSchedule[]
  myRewards?: RewardsByDenom[]
}

async function getValidatorInfo(operatorAddress: string): Promise<ValidatorResponse | undefined> {
  const validator = await getRepository(ValidatorInfoEntity).findOne({ operatorAddress })
  const { stakingReturn, isNewValidator } = await getValidatorAnnualAvgReturn(operatorAddress)
  const airdropReturn = await getAirdropAnnualAvgReturn()

  if (validator) {
    return generateValidatorResponse(validator, { stakingReturn: plus(stakingReturn, airdropReturn), isNewValidator })
  }

  return undefined
}

export async function getValidatorDetailUncached(
  operatorAddr: string,
  account?: string
): Promise<ValidatorDetailsReturn | undefined> {
  const validator = await getValidatorInfo(operatorAddr)

  if (!validator) {
    return
  }

  const commissions = sortDenoms(await getCommissions(operatorAddr))

  let result: ValidatorDetailsReturn = {
    ...validator,
    commissions
  }

  if (account) {
    const priceObj = await lcd.getActiveOraclePrices()
    const myDelegation = await getMyDelegation(account, validator)
    const myBalance = await getBalance(account)
    const ulunaBalance = filter(myBalance.balance, { denom: 'uluna' })[0]
    const myUndelegation =
      myBalance.unbondings &&
      getUndelegateSchedule(filter(myBalance.unbondings, { validator_address: operatorAddr }), {
        [operatorAddr]: validator
      })

    let myRewards

    if (myDelegation) {
      const rewards = await lcd.getRewards(account, operatorAddr)

      let total = '0'
      const denoms = rewards.map(({ denom, amount }) => {
        const adjustedAmount = denom === 'uluna' ? amount : priceObj[denom] ? div(amount, priceObj[denom]) : 0
        total = plus(total, adjustedAmount)
        return { denom, amount, adjustedAmount }
      })

      myRewards = {
        total,
        denoms
      }
    }

    result = {
      ...result,
      myDelegation,
      myUndelegation,
      myDelegatable: ulunaBalance && ulunaBalance.delegatable,
      myRewards
    }
  }

  return result
}

export const getValidatorDetail = memoizeCache(getValidatorDetailUncached, {
  promise: true,
  maxAge: 10 * 1000 // 10 seconds
})
export default getValidatorDetail
